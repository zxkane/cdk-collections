import { Stack, StackProps, Stage, StageProps } from 'aws-cdk-lib';
import { Cache, LocalCacheMode, BuildSpec } from 'aws-cdk-lib/aws-codebuild';
import { CodePipeline, ShellStep, CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { TODOStack } from './main';

class TodolistApplication extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new TODOStack(this, 'serverlesstodo');
  }
}

export class TodolistPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // const repo
    const connectArn = scope.node.tryGetContext('SourceConnectionArn');
    if (!connectArn) {throw new Error('Must specify the arn of source repo connection.');}
    const oidcSecret: string = scope.node.tryGetContext('OIDCSerectArn');
    if (!oidcSecret) {throw new Error('Must specify the context "OIDCSerectArn" for storing secret.');}

    const pipeline = new CodePipeline(this, 'Pipeline', {
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection('zxkane/cdk-collections', 'master', {
          connectionArn: connectArn,
          codeBuildCloneOutput: true,
        }),
        installCommands: [
          'git submodule init && git submodule update && git submodule sync',
          'npm i --prefix serverlesstodo/frontend',
          'npm run build --prefix serverlesstodo/frontend',
          'yarn --cwd serverlesstodo install --check-files --frozen-lockfile',
        ],
        commands: [
          'cd serverlesstodo',
          'npx projen',
          'npx projen test',
          `npx cdk synth serverlesstodo -c OIDCSerectArn=${oidcSecret} -c SourceConnectionArn=${connectArn} -c CognitoDomainPrefix=todolist-userpool-prod`,
        ],
        primaryOutputDirectory: 'serverlesstodo/cdk.out/',
      }),
      dockerEnabledForSynth: true,
      codeBuildDefaults: {
        cache: Cache.local(LocalCacheMode.SOURCE, LocalCacheMode.DOCKER_LAYER),
      },
      synthCodeBuildDefaults: {
        partialBuildSpec: BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': {
                nodejs: 14,
              },
            },
          },
        }),
      },
    });

    pipeline.addStage(new TodolistApplication(this, 'Prod', {
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
      },
    }));
  }
}