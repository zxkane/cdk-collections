#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { BatchAppStack } from '../lib/batch-app';

const app = new cdk.App();
new BatchAppStack(app, 'BatchAppStack', {
    env: { 
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT
    },
});

cdk.Tag.add(app, 'app', 'batch-app');
