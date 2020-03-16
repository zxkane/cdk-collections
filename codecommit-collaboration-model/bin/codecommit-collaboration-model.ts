#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CodecommitCollaborationModelStack } from '../lib/codecommit-collaboration-model-stack';

const app = new cdk.App();
new CodecommitCollaborationModelStack(app, 'CodecommitCollaborationModelStack');
