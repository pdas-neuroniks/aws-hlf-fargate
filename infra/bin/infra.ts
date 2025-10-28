#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as gitBranch from 'git-branch';
import { InfraStack } from '../lib/infra-stack';
import { CDKContext } from '../lib/types';

const app = new cdk.App();

const currentBranch = process.env.AWS_BRANCH || gitBranch.sync();

const globals = app.node.tryGetContext('globals') || {}

const branchConfig = app.node.tryGetContext(currentBranch);

const context: CDKContext & cdk.StackProps = {
    branch: 'main',
    ...globals,
    ...branchConfig
}

const appName = `${context.appName}-${context.stage}`
const stackName = `${appName}-Stack`

new InfraStack(app, stackName, {
    enableLocalhost: true,
    env: context.env
}, context);