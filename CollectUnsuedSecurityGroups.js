const AWS = require('aws-sdk');
const fs = require('fs');
const DEFAULT_TIME = 60;
const DEFAULT_INTERVAL = 10;

function removeDuplicates(myArr, prop) {
    let result = myArr.reduce((unique, o) => {
        if (!unique.some(obj => obj[prop] === o[prop])) {
            unique.push(o);
        }
        return unique;
    }, []);
    return result
}

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
                instance.SecurityGroups.forEach(sg => sg.GroupId ? used.push({
                    groupId: sg.GroupId,
                    groupName: sg.GroupName
                }) : null);
                instance.NetworkInterfaces.forEach(ni => ni.Groups.forEach(nig => nig.GroupId ? used.push({
                    groupId: nig.GroupId,
                    groupName: nig.GroupName
                }) : null));
            }))),
        ec2.describeVpcEndpoints().promise().then(response => response.VpcEndpoints.forEach(endpoint => endpoint.Groups
            .forEach(group => group.GroupId ? used.push({groupId: group.GroupId, groupName: group.GroupName}) : null))),
        ec2.describeNetworkInterfaces().promise().then(result => result.NetworkInterfaces
            .forEach(ni => ni.Groups.forEach(group => group.GroupId ? used.push({
                groupId: group.GroupId,
                groupName: group.GroupName
            }) : null))),
        elb.describeLoadBalancers().promise().then(response => response.LoadBalancerDescriptions.forEach(elb => elb.SecurityGroups
            .forEach(elbSecurityGroup => used.push({groupId: elbSecurityGroup})))),
        alb.describeLoadBalancers().promise().then(response => response.LoadBalancers.forEach(alb => alb.SecurityGroups
            .forEach(albSG => used.push({groupId: albSG})))),
        rds.describeDBSecurityGroups().promise().then(response => response.DBSecurityGroups.forEach(dbSecurityGroups => dbSecurityGroups.EC2SecurityGroups
            .forEach(ec2SecurityGroup => ec2SecurityGroup.EC2SecurityGroupId ? used.push({
                groupId: ec2SecurityGroup.EC2SecurityGroupId,
                groupName: ec2SecurityGroup.EC2SecurityGroupName
            }) : null)))
    ]).catch(error => Promise.reject(`Failed to get all security groups in use, ${error.message}`));
    if (used.length > 0) {
        used = removeDuplicates(used, 'groupId');
    }
    return used;
}

async function getAllSecurityGroupsForRegion(region, sts) {
    AWS.config.region = region;
    const ec2 = sts ? new AWS.EC2(sts) : new AWS.EC2();
    return await ec2.describeSecurityGroups().promise().then(response => response.SecurityGroups)
        .then(sg => sg.map(s => (
            {groupId: s.GroupId, groupName: s.GroupName})
        ).filter(grp => grp.groupName != 'default')) //filter out default VPC SG
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

        console.log(`Found ${unusedGroupsNum} unused groups.${unusedGroupsNum > 0 ? ' Their IDs and Names:' : ''}`);
        Object.keys(unusedGroups).forEach(region => {
            unusedGroups[region].forEach(sg => console.log(`${region}: ID: ${sg.groupId}, Name: ${sg.groupName}`));
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
    if (profile) {
        AWS.config.credentials = new AWS.SharedIniFileCredentials({profile: profile});
    }
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
                await unusedGroupsObject[region].forEach(async sg => {
                    unusedSgs.push({
                        region: region,
                        groupId: sg.groupId,
                        groupName: sg.groupName
                    });
                });
            });
            setInterval(() => {
                console.log("Re-sampling security groups...");
                let usedSgs = {};
                let usedSgsPerRegion;
                unusedSgs.forEach(async (sg) => {
                    if (!usedSgs[sg.region]) {
                        usedSgsPerRegion = await getAllSecurityGroupsInUse(sg.region, null);
                        usedSgs[sg.region] = usedSgsPerRegion;
                    }
                    if (usedSgs[sg.region].map(usedSg => usedSg.groupId).includes(sg.groupId)) {
                        unusedSgs = unusedSgs.filter(x => x.groupId !== sg.groupId);
                        console.log(`Dropped ${sg.groupId} from unused security groups`);
                    }


                });
            }, interval * 60 * 1000);
        });
};

if (!time) {
    time = DEFAULT_TIME;
}
if (!interval) {
    interval = DEFAULT_INTERVAL;
}
setTimeout(() => {
    const unusedSgFilePath = `${process.env.PWD}/unused_security_groups.json`;
    fs.writeFileSync(unusedSgFilePath, JSON.stringify(unusedSgs, null, 2), 'utf-8');
    console.log(`Unused security groups tracked for ${time} minuets at intervals of ${interval} minuets found at ${unusedSgFilePath} `)
    process.exit(0);
}, time * 60 * 1000);

collectUnusedSecurityGroups(profile);

