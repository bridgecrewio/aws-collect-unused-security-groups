# Collect unused security groups of an aws account
A script to track unused security groups of an AWS account over period of time with control of the interval to sample the security groups usage. 
This script is useful when trying to detect usage of security groups by ephemeral resources 

## Table of contents
* [Setup](#setup)
* [Execution](#execution)
* [Contact](#contact)


## Setup
Configure aws sdk with the account to collect (`~/.aws/credentials file`)
Run `npm install`
## Execution
Run the script with your default configured AWS profile by running: 
```bash 
node CollectUnusedSecurityGroup.js
```
It will collect unused groups for one hour, and will re-sample the security groups for every 5 minutes. <br>
To change the sampling parameters, refer: <br>
 
#### Parameters:
```
 -p / -profile      The AWS profile to be used, as defined in the AWS credentials file
 -t / -time         The amount of time to run the script (in minutes)
 -i / -interval     The time interval to sample the unused security groups (in minutes)
 --no-default	    Skip groups named 'default', which are typically default VPC security groups, and can't be deleted
```
Running example: 
```bash 
node CollectUnusedSecurityGroup.js -p <aws_profile> -t <time_period> -i <interval_time> 
```
Output example json containing unused security groups over the entire period:
```
[
{
    "region": "us-east-1",
    "groupId": "sg-111",
    "groupName": "prod-rds"
  },
  {
    "region": "us-east-1",
    "groupId": "sg-2222",
    "groupName": "k8s-elb"
  },
  {
    "region": "us-east-1",
    "groupId": "sg-333",
    "groupName": "bastion-elb"
  },
  ...
]  
```

Note: Interval time units are in minutes

## Contact
Created by [Bridgecrew](https://www.bridgecrew.io)
