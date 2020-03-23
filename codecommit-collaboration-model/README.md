# A best practice model of using CodeCommit collaboration

The CodeCommit Collaboration Model consists of two roles,

1. The Admin role of CodeCommit repos who has administrative privilleges of repo, such as updating repo info, pulling/pushing code(excluding the `master` branch) and approving/merging pull requests.
2. The Collaborator role of CodeCommit repos who only has permissions for pulling/pushing/merging code(only the prefix of branch name with `pr/`, `features/` and `bugs/`), creating pull requests.

Above two policies only apply the repositories of CodeCommit matching given tags combination.

This demo app will create three repositories for demonstrating the collaboration model, only one repository(named `App1`) will be applied above collaboration model.

Also two demo users are created with corresponding policy. Freely create ak/sk or console password for playing with the collaboration model of CodeCommit.

# CI/CD of CodeCommit collaboration

This project also creates two CodeBuild projects for corresponding pull requests creation/updation and `master` branch commits. The PR build will automatically add build status to the trigger pull request as comments, then vote approval `+1` if the build successes.

## How to deploy demo app
```shell
# install dependencies
npm i

./node_modules/aws-cdk/bin/cdk deploy 
```