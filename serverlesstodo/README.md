# Serverless TODO app

## Deploy from source

### Prerequisites

- An AWS account
- Configure [credential of aws cli][configure-aws-cli]
- Install node.js LTS version, such as 14.x
- [Install yarn][install-yarn]

### Deploy it from source
1. install dependencies
```bash
yarn install --check-files --frozen-lockfile
npx projen
```
1. build frontend project
```bash
npm i --prefix frontend
npm run build --prefix frontend
```
1. deploy 
```bash
npx cdk deploy
```

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