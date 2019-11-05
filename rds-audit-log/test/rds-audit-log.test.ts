import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import cdk = require('@aws-cdk/core');
import RdsAuditLog = require('../lib/rds-audit-log-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new RdsAuditLog.RdsAuditLogStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});