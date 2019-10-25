#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { StorageClassEfsStack } from '../lib/storage-class-efs-stack';

const app = new cdk.App();
new StorageClassEfsStack(app, 'StorageClassEfsStack', {
    env: { 
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT
    },
});
