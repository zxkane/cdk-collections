import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import Ec2LaunchTemplateWithCloudwatchAgent = require('../lib/ec2-launch-template-with-cloudwatch-agent-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new Ec2LaunchTemplateWithCloudwatchAgent.Ec2LaunchTemplateWithCloudwatchAgentStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});