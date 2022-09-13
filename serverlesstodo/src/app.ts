import { App } from 'aws-cdk-lib';
import { TODOStack } from './main';
import { TodolistPipelineStack } from './pipeline';

const app = new App();

new TodolistPipelineStack(app, 'TodolistPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new TODOStack(app, 'serverlesstodo', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

app.synth();