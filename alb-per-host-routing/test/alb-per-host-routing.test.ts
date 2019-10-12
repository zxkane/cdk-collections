import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import AlbPerHostRouting = require('../lib/alb-per-host-routing-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new AlbPerHostRouting.AlbPerHostRoutingStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});