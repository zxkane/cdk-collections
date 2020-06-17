#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { EcsSonatypeNexus3Stack } from '../lib/ecs-sonatype-nexus3-stack';

const app = new cdk.App();
new EcsSonatypeNexus3Stack(app, 'EcsSonatypeNexus3Stack', {
    env: {
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT,
    }
});

cdk.Tag.add(app, 'usage', 'Nexus3');
