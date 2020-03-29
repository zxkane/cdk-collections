# A best practice model of using CodeCommit collaboration

The CodeCommit Collaboration Model consists of two roles,

1. The Admin role of CodeCommit repos who has administrative privilleges of repo, such as updating repo info, pulling/pushing code(excluding the `master` branch) and approving/merging pull requests.
2. The Collaborator role of CodeCommit repos who only has permissions for pulling/pushing/merging code(only the prefix of branch name with `pr/`, `features/` and `bugs/`), creating pull requests.

Above two policies only apply the repositories of CodeCommit matching the combination of given tags.

This demo app will create three repositories for demonstrating the collaboration model, only one repository(named `App1`) will be applied above collaboration model.

And this demo will create an approval rule template of CodeCommit and associate it with the repos, which requires at least two approval votes from repo admin user and the role of PR build for all pull requests targeting to master branch.

At last two repo users(one is collaborator of repo and the other is admin of repo) are created with corresponding policy. Freely create ak/sk or console password for playing with the collaboration model of CodeCommit.

# CI/CD of CodeCommit collaboration

This project creates two CodeBuild projects for corresponding pull requests creation/updation and `master` branch commits. The PR build will automatically add build status to the trigger pull request as comments, then vote approval `+1` if the build successes.

## How to deploy demo app

### Prerequisites

- Install Node LTS(such as 12.x)
- Configure your AWS account for [awscli](https://docs.aws.amazon.com/polly/latest/dg/setup-aws-cli.html)
  
### Deploy it!
```shell
# build lambda code for cfn custom resource 'ApprovalRuleTemplate' and 'ApprovalRuleRepoAssociation'
cd assets
npm i && npm run build
# install dependencies
cd ../
npm i

./node_modules/aws-cdk/bin/cdk deploy 
```