#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import regionInfo = require('@aws-cdk/region-info');
import { Ec2LaunchTemplateMultipleRegionsStack } from '../lib/ec2-launch-template-multiple-regions-stack';

const app = new cdk.App();
const tokenRegion = process.env.CDK_DEFAULT_REGION;
if (tokenRegion){
    const partition = tokenRegion.startsWith('cn-') ? 'aws-cn' : 'aws';
    for (const region of regionInfo.RegionInfo.regions) {    
        if (region.partition == partition) {
            new Ec2LaunchTemplateMultipleRegionsStack(app, `MyEc2LaunchTemplate-${region.name}`, {
                env: { 
                    region: region.name
                },
            });
        }
    }
} else {
    throw new Error(`There is no default region.`);
}
