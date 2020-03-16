import * as cdk from '@aws-cdk/core';
import codecommit = require('@aws-cdk/aws-codecommit');
import iam = require('@aws-cdk/aws-iam');
import { CodecommitCollaborationModel } from './codecommit-policy';

export class CodecommitCollaborationModelStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const stack = cdk.Stack.of(this);

    const repo1 = new codecommit.Repository(this, 'Repository1' ,{
      repositoryName: `${stack.stackName}-MyApp1`,
      description: 'Repo fo App1.', // optional property
    });
    cdk.Tag.add(repo1, 'app', 'my-app-1');
    cdk.Tag.add(repo1, 'cost-center', '12345');
    cdk.Tag.add(repo1, 'team', 'abc');

    const repo2 = new codecommit.Repository(this, 'Repository2' ,{
      repositoryName: `${stack.stackName}-MyApp2`,
      description: 'Repo fo App2.', // optional property
    });
    cdk.Tag.add(repo2, 'app', 'my-app-2');
    cdk.Tag.add(repo2, 'team', 'abc');

    const codeCollaboratorModel = new CodecommitCollaborationModel(this, `CodecommitCollaborationModel`, {
      name: 'MyApp1',
      tags: {
        'app': 'my-app-1',
        'team': 'abc',
      }
    });

    const repoAdmin = new iam.User(this, 'Repo1Admin', {
      path: '/codecommitmodel/',
    });
    repoAdmin.attachInlinePolicy(codeCollaboratorModel.codeCommitAdminPolicy);
    const repo1Collaborator = new iam.User(this, 'Repo1Collaborator', {
      path: '/codecommitmodel/',
    });
    repo1Collaborator.attachInlinePolicy(codeCollaboratorModel.codeCommitCollaboratorPolicy);

    // create a repo without tags either 'app' or 'team'
    const repo3 = new codecommit.Repository(this, 'Repository3' ,{
      repositoryName: `${stack.stackName}-MyApp3`,
      description: 'Repo fo App3.',
    });

    new cdk.CfnOutput(this, 'IAMUser:RepoAdmin', {
      value: `${repoAdmin.userName}`,
      exportName: 'AdminUsername',
      description: 'admin of repo'
    });
    new cdk.CfnOutput(this, 'IAMUser:RepoCollaborator', {
      value: `${repo1Collaborator.userName}`,
      exportName: 'CollaboratorUsername',
      description: 'collaborator of repo'
    }); 

  }
}
