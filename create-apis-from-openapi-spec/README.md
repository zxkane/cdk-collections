# Create AWS API Gateway from OpenAPI specification(OAS)

It's the companion sample code of blog post [Define your API via OpenAPI definition on AWS][blog-post], this code demonstrates below capabilities,

- import OAS as HTTP API
- import OAS as REST API
- API integrates with Amazon SQS
 
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
2. deploy
```bash
npx cdk deploy
```

[blog-post]: https://kane.mx/posts/2022/import-oas-as-api-on-aws/
[install-yarn]: https://classic.yarnpkg.com/lang/en/docs/install/
[configure-aws-cli]: https://docs.aws.amazon.com/zh_cn/cli/latest/userguide/cli-chap-configure.html