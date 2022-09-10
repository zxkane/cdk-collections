const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'serverlesstodo',

  deps: [
    '@aws-solutions-constructs/aws-cloudfront-s3',
    '@aws-lambda-powertools/logger',
    '@types/aws-lambda@^8.10.102',
    'aws-jwt-verify@^3.1.0',
    'jwt-decode',
  ], /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();