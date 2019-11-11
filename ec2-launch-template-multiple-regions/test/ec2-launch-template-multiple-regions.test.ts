import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import Ec2LaunchTemplateMultipleRegions = require('../lib/ec2-launch-template-multiple-regions-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new Ec2LaunchTemplateMultipleRegions.Ec2LaunchTemplateMultipleRegionsStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});