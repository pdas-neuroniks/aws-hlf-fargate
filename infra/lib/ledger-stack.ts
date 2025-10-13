import * as cdk from 'aws-cdk-lib';
import * as secretmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as managedblockchain from 'aws-cdk-lib/aws-managedblockchain';
import { Construct } from 'constructs';
import { CDKContext } from './types';


interface LedgerStackProps {
    name: string
}

export class LedgerStack extends Construct {

    constructor(scope: Construct, id: string, props: LedgerStackProps, context: CDKContext){

        super(scope, id);
        const appName = `${context.appName}-${context.stage}`;


        const adminPasswordSecret = secretmanager.Secret.fromSecretAttributes(this, 'AdminPasswordSecret', {
            secretCompleteArn: `arn:aws:secretsmanager:${context.env.region}:${context.env.account}:secret:${appName}-admin-password` // cdk.Fn.importValue(`${appName}-document-ledger-admin-password-arn`)    
        });

        const adminPassword = adminPasswordSecret.secretValue.toString();

        const networkName = `${appName}-Network`;
        const memberName = `${appName}-Member`;
        const userName = 'admin';

        const networkConfiguration = {
            name: networkName,
            description: 'Managed Blockchain Network for Biologics Ledger',
            framework: 'HYPERLEDGER_FABRIC',
            frameworkVersion: '2.2',
            networkFrameworkConfiguration: {
                networkFabricConfiguration: {
                    edition: 'STARTER', 
                },
            },
            votingPolicy: {
                approvalThresholdPolicy: {
                    thresholdPercentage: 50,
                    proposalDurationInHours: 24,
                    thresholdComparator: 'GREATER_THAN_OR_EQUAL_TO'
                }
            },
        }

        const memberConfiguration = {
            name: memberName,
            description: 'Member for Biologics Ledger',
            memberFrameworkConfiguration: {
                memberFabricConfiguration: {
                    adminUsername: userName,
                    adminPassword: adminPassword
                }
            },
        }

        const nodeConfiguration = {
            instanceType: 'bc.t3.small',
            availabilityZone: 'us-east-1a'
        }

        const network = new managedblockchain.CfnMember(this, `${appName}-Ledger`, {
            networkConfiguration,
            memberConfiguration,
        })
        
        const networkId = network.getAtt('NetworkId').toString();
        const memberId = network.getAtt('MemberId').toString();

        const memberProps: managedblockchain.CfnMemberProps = {
            networkId, 
            // memberId,
            memberConfiguration
        }

        const node = new managedblockchain.CfnMember(
            this, 
            `${appName}-Ledger-Node`, 
            memberProps
        );

        const nodeId = node.getAtt('NodeId').toString();

        new cdk.CfnOutput(this, 'NetworkName', {
            value: networkName,
            exportName: `${appName}-NetworkName`
        });

        new cdk.CfnOutput(this, 'NetworkId', {
            value: networkId,
            exportName: `${appName}-NetworkId`
        });

        new cdk.CfnOutput(this, 'MemberId', {
            value: memberId,
            exportName: `${appName}-MemberId`
        });

        new cdk.CfnOutput(this, 'NodeId', {
            value: nodeId,
            exportName: `${appName}-NodeId`
        });

        new cdk.CfnOutput(this, 'AdminUsername', {
            value: userName,
            exportName: `${appName}-AdminUsername`
        });

        new cdk.CfnOutput(this, 'AdminPasswordSecretArn', {
            value: adminPasswordSecret.secretArn,
            exportName: `${appName}-AdminPasswordSecretArn`
        });
    }
}