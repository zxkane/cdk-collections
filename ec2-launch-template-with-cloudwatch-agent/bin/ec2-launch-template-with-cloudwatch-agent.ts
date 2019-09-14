#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { Ec2LaunchTemplateWithCloudwatchAgentStack } from '../lib/ec2-launch-template-with-cloudwatch-agent-stack';

const app = new cdk.App();
new Ec2LaunchTemplateWithCloudwatchAgentStack(app, 'Ec2LaunchTemplateWithCloudwatchAgentStack');
