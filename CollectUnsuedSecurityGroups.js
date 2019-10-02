const AWS = require('aws-sdk');
const fs = require('fs');

async function getAllSecurityGroupsInUse(region, sts) {
    AWS.config.region = region;
    const ec2 = sts ? new AWS.EC2(sts) : new AWS.EC2();
    const elb = sts ? new AWS.ELB(sts) : new AWS.ELB();
    const alb = sts ? new AWS.ELBv2(sts) : new AWS.ELBv2();
    const rds = sts ? new AWS.RDS(sts) : new AWS.RDS();

    let used = [];

    await Promise.all([
        ec2.describeInstances().promise().then(resp => resp.Reservations).then(reservations => reservations.forEach(reservation => reservation.Instances
            .forEach(instance => {
                instance.SecurityGroups.forEach(sg => used.push(sg.GroupId));
                instance.NetworkInterfaces.forEach(ni => ni.Groups.forEach(nig => used.push(nig.GroupId)));
            }))),
        ec2.describeVpcEndpoints().promise().then(response => response.VpcEndpoints.forEach(endpoint => endpoint.Groups
            .forEach(group => used.push(group.GroupId)))),
        ec2.describeNetworkInterfaces().promise().then(result => result.NetworkInterfaces
            .forEach(ni => ni.Groups.forEach(group => used.push(group.GroupId)))),
        elb.describeLoadBalancers().promise().then(response => response.LoadBalancerDescriptions.forEach(elb => elb.SecurityGroups
            .forEach(elbSecurityGroup => used.push(elbSecurityGroup)))),
        alb.describeLoadBalancers().promise().then(response => response.LoadBalancers.forEach(alb => alb.SecurityGroups
            .forEach(albSG => used.push(albSG)))),
        rds.describeDBSecurityGroups().promise().then(response => response.DBSecurityGroups.forEach(dbSecurityGroups => dbSecurityGroups.EC2SecurityGroups
            .forEach(ec2SecurityGroup => used.push(ec2SecurityGroup.EC2SecurityGroupId)))),
        ec2.describeVpcEndpoints({MaxResults: 1000}).promise().then(result => result.VpcEndpoints.forEach(endpoint => endpoint.Groups
            .forEach(group => used.push(group.GroupId))))
    ]).catch(error => Promise.reject(`Failed to get all security groups in use, ${error.message}`));

    return used;
}

async function getAllSecurityGroupsForRegion(region, sts) {
    AWS.config.region = region;
    const ec2 = sts ? new AWS.EC2(sts) : new AWS.EC2();
    return await ec2.describeSecurityGroups().promise().then(response => response.SecurityGroups)
        .then(sg => sg.map(s => s.GroupId))
        .catch(error => Promise.reject(`Failed to describe security groups, ${error.message}`));
}

function scanForUnusedSecurityGroups(regions, sts) {
    const unusedGroups = {};
    console.log('Looking for unused security groups');

    return Promise.all(regions.map(async region => {
        const used = await getAllSecurityGroupsInUse(region, sts);
        const allSG = await getAllSecurityGroupsForRegion(region, sts);

        const unused = allSG.filter(sg => !used.includes(sg));
        if (unused.length > 0) {
            unusedGroups[region] = unused;
        }
    })).then(() => {
        const unusedGroupsNum = Object.values(unusedGroups).reduce((acc, regionalSecurityGroups) => acc + regionalSecurityGroups.length, 0);

        console.log(`Found ${unusedGroupsNum} unused groups.${unusedGroupsNum > 0 ? ' Their IDs:' : ''}`);
        Object.keys(unusedGroups).forEach(region => {
            unusedGroups[region].forEach(sg => console.log(`${region}: ${sg}`));
        });

        return unusedGroups;
    });
}

let args = process.argv.slice(2, process.argv.length);
let profile, time, interval;
let unusedSgs = [];

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case "-p":
        case "-profile":
            profile = args[i + 1];
            i += 1;
            continue;
        case "-t":
        case "-time":
            time = args[i + 1];
            i += 1;
            continue;
        case "-i":
        case "-interval":
            interval = args[i + 1];
            i += 1;
            continue;
        case "-h":
        case "help":
        case "-help":
            console.log(`Synopsis:\n\nThis script collects unused security groups.\n` +
                `To launch it, supply the as set in your AWS credentials file, as such:\n` +
                `node CollectUnusedSecurityGroups.js\n` +
                `Parameters: \n-p / -profile\tThe AWS profile to be used, as defined in the AWS credentials file\n` +
                `-t / -time \\tThe amount of time to run the script (in minuets)\\n` +
                `-i / -interval\\tThe time interval to sample the unused security groups (in minuets)\\n` +
                `Example:\n node CollectUnusedSecurityGroup.js -p dev -t 60 -i 5\n`);
            return;
        default:
            console.error("Bad params\n");
            process.exit(1);
    }
}

const collectUnusedSecurityGroups = async (profile) => {
    AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: profile});
    if (!AWS.config.region) {
        AWS.config.update({region: 'us-west-2'}); // Default region, just to get the available regions
    }
    let ec2 = new AWS.EC2();
    const regions = await ec2.describeRegions().promise().then(response => response.Regions.map(reg => reg.RegionName));

    scanForUnusedSecurityGroups(regions, null)
        .then(async unusedGroupsObject => {
            await Object.keys(unusedGroupsObject).forEach(async region => {
                AWS.config.update({region: region});
                ec2 = new AWS.EC2();
                await unusedGroupsObject[region].forEach(async groupId => {
                    unusedSgs.push({region, groupId});
                });
            });
            setInterval(() => {
                unusedSgs.forEach(async (sg) => {
                    const used = await getAllSecurityGroupsInUse(sg.region, null);
                    if (used.map(usedSg => usedSg.groupId).includes(sg.groupId)) {
                        unusedSgs = unusedSgs.filter(x => x.groupId !== sg.groupId);
                        console.log(`Dropped ${sg.groupId} from unused security groups`);
                    }
                });
            }, interval * 60 * 1000);
        });
};

if (profile) {
    if (profile === "default") {
        console.log('\nPlease replace the placeholder   default   with a profile from your AWS credentials file\n');
        process.exit(1);
    }
    setTimeout(() => {
        const unusedSgFilePath = `${process.env.PWD}/unused_security_groups.json`;
        fs.writeFileSync(unusedSgFilePath, JSON.stringify(unusedSgs, null, 2) , 'utf-8');
        console.log(`Unused security groups tracked for ${time} minuets at intervals of ${interval} minuets found at ${unusedSgFilePath} `)
        process.exit(0);
    }, time * 60 * 1000);

    collectUnusedSecurityGroups(profile);
} else {
    console.log('\nPlease insert AWS profile from your AWS credentials file with -p flag\n');
}
