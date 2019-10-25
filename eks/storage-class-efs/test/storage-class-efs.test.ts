import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import StorageClassEfs = require('../lib/storage-class-efs-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new StorageClassEfs.StorageClassEfsStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});