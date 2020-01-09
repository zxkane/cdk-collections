# README
Create a rest endpoint for [the signin callback of App Client of Cognito user pool][setup-cognito-appclient].

The signin callback page will fetch the JWT token from url, then request the actual user info from another restful endpoint created by this stack.

## Prerequisites
- `Python3` is installed
- Create a [user pool in Cognito][setup-userpool]
- Create an app client with **only** `Implicit code grant` checked

## How to deploy
```shell
# install dependencies of lambda functions
pip3 install -r assets/get-user/requirements.txt --target ./assets/get-user

cdk deploy -c -c userpool=<userpool id> -c appclient=<app client id>
```

## Usage
1. Configure the generated `CognitoAppClientSigninEndpoint` to App Client's `signin callback url` after successfully deploying this stack.
2. Launch `Hosted UI` of App Client to test the callback url functionality.

[setup-cognito-appclient]: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-app-idp-settings.html
[setup-userpool]: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-configuring-app-integration.html