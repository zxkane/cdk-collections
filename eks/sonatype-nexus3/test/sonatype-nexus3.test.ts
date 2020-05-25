import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as SonatypeNexus3 from '../lib/sonatype-nexus3-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new SonatypeNexus3.SonatypeNexus3Stack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
