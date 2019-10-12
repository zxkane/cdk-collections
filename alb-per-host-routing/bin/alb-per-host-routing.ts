#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { AlbPerHostRoutingStack } from '../lib/alb-per-host-routing-stack';

const app = new cdk.App();

const vpcId = app.node.tryGetContext('vpcId');
const hostnames = app.node.tryGetContext('hosts');
if (!hostnames) {
    throw new Error(`Pls specify the target hostnames, splitted by comma for multiple hostname.`);
}

new AlbPerHostRoutingStack(app, 'AlbPerHostRoutingStack', {
    vpcId,
    env: { 
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT
    },
    hosts: hostnames.split(','),
});
