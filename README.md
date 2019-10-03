# Collect unused security groups of an aws account
A script to track unused security groups of an AWS account over period of time with control of the interval to sample the security groups usage. 
This script is usefule when trying to detect usage of security groups by ephemeral resources 

## Table of contents
* [Setup](#setup)
* [Execution](#running)
* [Contact](#contact)


## Setup
Configure aws sdk with the account to collect (`~/.aws/credentials file`)
Run `npm install`
## Execution
Run the script by running: 
```bash 
node CollectUnusedSecurityGroup.js -p <aws_profile> -t <time_period> -i <interval_time> 
```
Output example:
`
[
  {
    "region": "eu-central-1",
    "groupId": "sg-id1"
  },
  {
    "region": "us-west-2",
    "groupId": "sg-id2"
  },
  ...
]  
`

Note: Interval time units are in minuets

## Contact
Created by [Bridgecrew](https://www.bridgecrew.io)
