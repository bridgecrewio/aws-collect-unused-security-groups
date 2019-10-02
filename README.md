# Collect unused security groups of an aws account
> A script to to track unused security groups of an AWS account 
> over period of time with control of the interval to sample the
> security groups

## Table of contents
* [Setup](#setup)
* [Execution](#running)
* [Contact](#contact)


## Setup
Configure aws sdk with the account to collect (~/.aws/credentials file)
Run npm install
## Execution
Run the script by runnig:
node CollectUnusedSecurityGroup.js -p <aws_profile> -t <time_period> -i <interval_time>


Note: time units are in minuets

## Contact
Created by Bridgecrew (https://www.bridgecrew.cloud)