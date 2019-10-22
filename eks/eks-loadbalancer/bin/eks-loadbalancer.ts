#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { EKSLoadbalancerStack } from '../lib/eks-loadbalancer-stack';

const app = new cdk.App();
new EKSLoadbalancerStack(app, 'EKSLoadbalancerStack');
