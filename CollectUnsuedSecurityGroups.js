const AWS = require('aws-sdk');
const fs = require('fs');
const DEFAULT_TIME = 60;
const DEFAULT_INTERVAL = 10;

function removeDuplicates(myArr) {
    const uniq = new Set(myArr.map(e => JSON.stringify(e)));
    return Array.from(uniq).map(e => JSON.parse(e));
}

async function getAllSecurityGroupsInUse(region, sts) {
    AWS.config.region = region;
    const ec2 = sts ? new AWS.EC2(sts) : new AWS.EC2();
    const elb = sts ? new AWS.ELB(sts) : new AWS.ELB();
    const alb = sts ? new AWS.ELBv2(sts) : new AWS.ELBv2();
    const rds = sts ? new AWS.RDS(sts) : new AWS.RDS();
    const lambda = sts ? new AWS.Lambda(sts) : new AWS.Lambda();

    let used = [];

    await Promise.all([
        ec2.describeInstances().promise().then(resp => resp.Reservations).then(reservations => reservations.forEach(reservation => reservation.Instances
            .forEach(instance => {
                instance.SecurityGroups.forEach(sg => used.push({groupId: sg.GroupId}));
                instance.NetworkInterfaces.forEach(ni => ni.Groups.forEach(nig => used.push({groupId: nig.GroupId})));
            }))),
        ec2.describeVpcEndpoints().promise().then(response => response.VpcEndpoints.forEach(endpoint => endpoint.Groups
            .forEach(group => used.push({groupId: group.GroupId})))),
        ec2.describeNetworkInterfaces().promise().then(result => result.NetworkInterfaces
            .forEach(ni => ni.Groups.forEach(group => used.push({groupId: group.GroupId})))),
        elb.describeLoadBalancers().promise().then(response => response.LoadBalancerDescriptions.forEach(elb => elb.SecurityGroups
            .forEach(elbSecurityGroup => used.push({groupId: elbSecurityGroup})))),
        alb.describeLoadBalancers().promise().then(response => response.LoadBalancers.forEach(alb => alb.SecurityGroups
            .forEach(albSG => used.push({groupId: albSG})))),
        rds.describeDBSecurityGroups().promise().then(response => response.DBSecurityGroups.forEach(dbSecurityGroups => dbSecurityGroups.EC2SecurityGroups
            .forEach(ec2SecurityGroup => used.push({groupId: ec2SecurityGroup.EC2SecurityGroupId})))),
        lambda.listFunctions().promise().then(response => response.Functions.filter(func => func.VpcConfig).forEach(func =>
            func.VpcConfig.SecurityGroupIds.forEach(group => used.push({groupId: group}))
        ))

    ]).catch(error => Promise.reject(`Failed to get all security groups in use, ${error.message}`));
    if (used.length > 0) {
        used = removeDuplicates(used);
    }
    return used;
}

async function getAllSecurityGroupsForRegion(region, sts) {
    AWS.config.region = region;
    const ec2 = sts ? new AWS.EC2(sts) : new AWS.EC2();
    return await ec2.describeSecurityGroups().promise().then(response => response.SecurityGroups)
        .then(sg => {
            let sg_list = sg.map(s => ({groupId: s.GroupId, groupName: s.GroupName}));
            if (filterDefaultVpcGroups) {
                sg_list = sg_list.filter(sg => sg.groupName != 'default');
            }
            return sg_list;
        })
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
let verbose = false;
let filterDefaultVpcGroups = false;
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
        case "-v":
        case "-verbose":
            verbose = true;
            continue;
        case "--no-default":
            filterDefaultVpcGroups = true;
            continue;
        case "-h":
        case "help":
        case "-help":
            console.log(`Synopsis:\n\nThis script collects unused security groups.\n` +
                `To launch it, supply the as set in your AWS credentials file, as such:\n` +
                `node CollectUnusedSecurityGroups.js\n` +
                `Parameters: \n-p / -profile\tThe AWS profile to be used, as defined in the AWS credentials file\n` +
                `-t / -time \tThe amount of time to run the script (in minutes)\n` +
                `-i / -interval\tThe time interval to sample the unused security groups (in minutes)\n` +
                `-v / -verbose\tIf set, print the current list of unused SGs after each interval\n` +
                `--no-default\tSkip groups named 'default', which are typically default VPC security groups, and can't be deleted\n`+
                `Example:\n node CollectUnusedSecurityGroup.js -p dev -t 60 -i 5 -v --no-default\n`);
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
            await Object.keys(unusedGroupsObject).forEach(region => {
                // AWS.config.update({region: region});
                // ec2 = new AWS.EC2();
                unusedGroupsObject[region].forEach(sg => {
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

                // This structure ensures that the unused SGs are dropped BEFORE
                // printing the output after each interval. Because getAllSecurityGroupsInUse
                // is asynchronous, we have to wait until it, and the subsequent map / drop logic,
                // is finished before we print the latest list of unused SGs. Otherwise, the
                // unused SGs will be printed based on their state BEFORE this interval, and will
                // always be one iteration behind.
                let requests = unusedSgs.reduce((promiseChain, sg) => {
                    return promiseChain.then(() => new Promise(async (resolve) => {
                            if (!usedSgs[sg.region]) {
                            usedSgsPerRegion = await getAllSecurityGroupsInUse(sg.region, null);
                            usedSgs[sg.region] = usedSgsPerRegion;
                        }
                        if (usedSgs[sg.region].map(usedSg => usedSg.groupId).includes(sg.groupId)) {
                            unusedSgs = unusedSgs.filter(x => x.groupId !== sg.groupId);
                            console.log(`Dropped ${sg.groupId} from unused security groups`);
                        }
                        resolve();
                    }));
                }, Promise.resolve());

                if (verbose) {
                    requests.then(() => {
                        console.log("Current list of unused SGs:")
                        console.log(unusedSgs);
                    });
                }
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
    console.log(`Unused security groups tracked for ${time} minutes at intervals of ${interval} minutes found at ${unusedSgFilePath} `)
    process.exit(0);
}, time * 60 * 1000);

collectUnusedSecurityGroups(profile).catch(error => {
    console.log(`Failed to collect security groups:\n ${error.message}`);
    process.exit(1);
});

