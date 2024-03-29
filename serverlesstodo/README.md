# Serverless TODO app

**It's a companion code repo of series of blog posts [Build serverless web application with AWS Serverless](https://kane.mx/posts/2022/build-serverless-app-on-aws/intro/).** 

## Deploy from source

### Prerequisites

- An AWS account
- Configure [credential of aws cli][configure-aws-cli]
- Install node.js LTS version, such as 14.x
- [Install yarn][install-yarn]

### Deploy web application from source
1. install dependencies
```bash
yarn install --check-files --frozen-lockfile
npx projen
```
2. build frontend project
```bash
git submodule init
git submodule sync
git submodule update
npm i --prefix frontend
npm run build --prefix frontend
```
3. deploy
```bash
npx cdk deploy
```
* Deploy with api gateway allowing CORS for local frontend(`http://localhost:3000/`) debugging
```bash
npx cdk deploy -c LocalDebugging=true
```
* Support third party OIDC providers(such as Auth0, Okta, Keycloak) as federation login
Create a secret in AWS Secrets Manager like below json,
```json
{
"clientId":"client id from OIDC provider",
"clientSecret":"client secret from OIDC provider",
"issuerUrl":"domain from OIDC provider",
"name":"any readable name for UI"
}
```
Then deploy the app with the secret ARN
```bash
npx cdk deploy -c OIDCSerectArn=arn:aws:secretsmanager:ap-southeast-1:<account id>:secret:auth0-todolist-RZcKC1
```

### Deploy CI/CD pipeline from source
1. [create source repo connection][codestar-connection]
2. Deploy pipeline via CLI
```bash
npx cdk deploy -c OIDCSerectArn=arn:aws:secretsmanager:ap-southeast-1:<account id>:secret:auth0-todolist-RZcKC1 TodolistPipelineStack -c SourceConnectionArn=arn:aws:codestar-connections:ap-southeast-1:<account id>:connection/59e3b9fd-b2a9-4bbf-b417-01c74326a58f
```
A CodePipeline will be created in your account to build, test and deploy the 
`Todolist` web application continously when source repo is changed.

## API Spec

All APIs must be requested with `Content-Type: application/json` header.

### TODO API

- Create a TODO item
```bash
PUT /todo

Body:
{
    "subject":"my-memo",
    "description":"hello world!!",
    "dueDate":1661926828
}

Response:
{
    "id": "todo-fbe33114-5217-4ad8-a601-284cf383590c",
    "subject": "my-memo",
    "description": "hello world!!",
    "dueDate": 1661926828,
    "createdTimeInMills": 1661438819355
}
```
- Update a TODO item
```bash
POST /todo/<todoId>

Body:
{
    "subject":"my-memo",
    "description":"hello world!!",
    "dueDate":1661926828
}

Response:
{
    "id": "todo-fbe33114-5217-4ad8-a601-284cf383590c",
    "subject": "my-memo",
    "description": "hello world!!",
    "dueDate": 1661926828,
    "createdTimeInMills": 1661438819355,
    "lastModifiedTimeInMills" : 1661438860588
}
```
- Delete a TODO item
```bash
DELETE /todo/<todoId>
```
- Get all TODO items
```bash
Get /todo

Response:
[
{
    "id": "todo-fbe33114-5217-4ad8-a601-284cf383590c",
    "subject": "my-memo",
    "description": "hello world!!",
    "dueDate": 1661926828,
    "createdTimeInMills": 1661438819355,
    "lastModifiedTimeInMills": 1661438860588,
}
...
]
```


[install-yarn]: https://classic.yarnpkg.com/lang/en/docs/install/
[configure-aws-cli]: https://docs.aws.amazon.com/zh_cn/cli/latest/userguide/cli-chap-configure.html
[codestar-connection]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscodestarconnections.html