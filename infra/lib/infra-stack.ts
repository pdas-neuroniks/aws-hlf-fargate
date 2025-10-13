import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LedgerStack } from './ledger-stack';
import { CDKContext } from './types';
// import * as sqs from 'aws-cdk-lib/aws-sqs';


interface InfraStackProps extends cdk.StackProps {
    // Add any additional properties here if needed
    enableLocalhost: boolean;
}

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props:InfraStackProps, context: CDKContext){

        super(scope, id, props);
        const appName = `${context.appName}-${context.stage}`;

        const ledgerStack = new LedgerStack(
            this,
            `${appName}-LedgerStack`,
            {
                name: appName,
            },
            context
        )

    }
}