import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import UserpoolAppclientCallback = require('../lib/userpool-appclient-callback-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new UserpoolAppclientCallback.UserpoolAppclientCallbackStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
