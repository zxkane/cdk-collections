#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { UserpoolAppclientCallbackStack } from '../lib/userpool-appclient-callback-stack';

const app = new cdk.App();
new UserpoolAppclientCallbackStack(app, 'UserpoolAppclientCallbackStack');
