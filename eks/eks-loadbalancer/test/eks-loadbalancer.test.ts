import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import NginxLoadbalancer = require('../lib/eks-loadbalancer-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new NginxLoadbalancer.EKSLoadbalancerStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});