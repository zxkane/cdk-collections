#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { RdsAuditLogStack } from '../lib/rds-audit-log-stack';
import { RdsLogSinkStack } from '../lib/log-sink-stack';

const app = new cdk.App();
const rdsStack = new RdsAuditLogStack(app, 'RdsAuditLogStack');
new RdsLogSinkStack(app, 'RdsLogSinkStack', {
    clusterid: rdsStack.dbclusterid
});
