import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as hyperledger from '@cdklabs/cdk-hyperledger-fabric-network';
import { Construct } from 'constructs';
import { CDKContext } from './types';
// import { HlfStack } from './hlf-stack';
// import { ManagedBlockchainStack } from './managed-blockchain-stack';
// import { LedgerStack } from './ledger-stack';
// import * as sqs from 'aws-cdk-lib/aws-sqs';


interface InfraStackProps extends cdk.StackProps {
    // Add any additional properties here if needed
    enableLocalhost: boolean;
}

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props:InfraStackProps, context: CDKContext){

        super(scope, id, props);
        const appName = `${context.appName}-${context.stage}`;
        const networkName = `${appName}-Network`;
        const memberName = `${appName}-Member`;
        const EC2_SSH_PORT = 22;
        const ALB_HTTP_PORT = 80;
        const EC2_KEY_PAIR_NAME = context.ec2KeyPairName || 'pdas-dev';


        // VPC Creation 


        const vpc = new ec2.Vpc(this, `${appName}-VPC`, {
            maxAzs: 2, // Use 2 Availability Zones for resilience
            // Disable NAT Gateway creation
            natGateways: 1,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'PrivateForBlockchain', // Subnet for Fargate tasks
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // Needs egress via endpoints
                }
            ],
        });


        // Hyperledger Fabric Network on Managed Blockchain 


        const network = new hyperledger.HyperledgerFabricNetwork(this, `${appName}-HLF-Network`, {
            networkName: `${networkName}`,
            memberName: `${memberName}`,
            networkDescription: `Managed Blockchain Network for ${networkName}-${context.env.account}-${context.env.region} Network Description`,
            memberDescription: `Managed Blockchain Network for ${networkName}-${context.env.account}-${context.env.region} Member Description`,
            frameworkVersion: hyperledger.FrameworkVersion.VERSION_2_2,
            proposalDurationInHours: 48,
            thresholdPercentage: 75,
            users: [
                { userId: 'AppUser1', affilitation: `${memberName}` },
                { userId: 'AppUser2', affilitation: `${memberName}.department1` },
            ],
            nodes: [
                {
                    availabilityZone: 'us-east-1a',
                    instanceType: hyperledger.InstanceType.STANDARD5_LARGE,
                },
                {
                    availabilityZone: 'us-east-1b',
                    instanceType: hyperledger.InstanceType.STANDARD5_LARGE,
                },
            ],
            client: {
                vpc,
            }
        });


        // Security Groups 


        const ec2SecurityGroup = new ec2.SecurityGroup(this, `${appName}-EC2-SG`, {
            vpc: vpc,
            description: 'Allow outbound to Interface VPC Endpoint.',
            allowAllOutbound: true,
        });


        const endpointSecurityGroup = new ec2.SecurityGroup(this, `${appName}-Endpoint-SG`, {
            vpc: vpc,
            description: 'Allow inbound from EC2 to Interface Endpoint.',
            allowAllOutbound: true,
        });

        
        /* const endpointSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this, 
            `${appName}-Endpoint-SG`, // Logical ID for the imported security group
            'sg-0c7d563015ce774c4'
        ); */


        const eiceSecurityGroup = new ec2.SecurityGroup(this, `${appName}-EICESG`, {
            vpc,
            description: 'Security Group for EC2 Instance Connect Endpoint',
        });
                
        
        eiceSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(), 
            ec2.Port.tcp(22), 
            'Allow SSH from public internet to EICE'
        );


        ec2SecurityGroup.addIngressRule(
            endpointSecurityGroup,
            ec2.Port.tcp(30002),
            'Allow inbound HTTPS from Endpoint Security Group'
        );
        // Add an inbound rule to allow all TCP traffic from anywhere
        ec2SecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp(), 'Allow all TCP traffic from anywhere');
        // Add an inbound rule to allow all UDP traffic from anywhere
        ec2SecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allUdp(), 'Allow all UDP traffic from anywhere');
        // Add an inbound rule to allow all ICMP traffic from anywhere (optional, useful for ping)
        ec2SecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allIcmp(), 'Allow all ICMP traffic from anywhere');


        ec2SecurityGroup.addIngressRule(
            eiceSecurityGroup,
            ec2.Port.tcp(22),
            'Allow SSH from EC2 Instance Connect Endpoint'
        );


        // 4. EC2 Instance COnnect Endpoint Creation 🖥️

        new ec2.CfnInstanceConnectEndpoint(this, `${appName}-EC2InstanceConnectEndpoint`, {
            subnetId: vpc.publicSubnets[0].subnetId, // EICE sits in a public subnet
            securityGroupIds: [eiceSecurityGroup.securityGroupId],
            preserveClientIp: true,
        });


    
        // 3. IAM Role for EC2 (Permissions) 🧑‍💻

        // This role is for the EC2 instance to interact with other AWS services.
        const ec2Role = new iam.Role(this, `${appName}-EC2ClientRole`, {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            description: 'IAM role for EC2 Managed Blockchain client',
        });

        // Grant read-only access to Managed Blockchain (required for client operations)
        ec2Role.addToPolicy(new iam.PolicyStatement({
            actions: [
                'managedblockchain:GetMember',
                'managedblockchain:GetNode',
                'managedblockchain:ListNodes',
                'managedblockchain:GetNetwork',
                'managedblockchain:ListNetworks',
                'managedblockchain:ListMembers',
                'managedblockchain:ListNodes',
                'managedblockchain:ListProposals',
                'managedblockchain:GetProposal',
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
            ],
            resources: ['*'], // Granular resource access recommended in production
            effect: iam.Effect.ALLOW,
        }));
            
        // Add AWS managed policy for basic EC2 functionality
        ec2Role.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore') // Useful for session manager access
        );
        

        // EC2 Instance Creation 🖥  ️


        const ami = new ec2.AmazonLinuxImage({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        });

        const instance = new ec2.Instance(this, `${appName}-HyperledgerFabricClient`, {
            vpc,
            instanceType: ec2.InstanceType.of(
                ec2.InstanceClass.T2,
                ec2.InstanceSize.MICRO
            ),
            machineImage: ami,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Place in a private subnet
            securityGroup: ec2SecurityGroup, // existingSecurityGroup, // ec2SecurityGroup,
            keyName: EC2_KEY_PAIR_NAME,
            role: ec2Role,
            // User data to install a basic HTTP server for the ALB health check
            userData: ec2.UserData.custom(`#!/bin/bash
                sudo yum update -y
                sudo yum install -y httpd
                sudo systemctl start httpd
                sudo systemctl enable httpd
                echo "<h1>Hello from Fabric Client</h1>" | sudo tee /var/www/html/index.html
            `),
        });


        



        // Output the public IP address of the EC2 instance
        new cdk.CfnOutput(this, 'InstanceId', {
            value: instance.instanceId,
            description: 'The instance Id',
        });
        new cdk.CfnOutput(this, 'InstancePrivateIp', {
            value: instance.instancePrivateIp,
            description: 'The private IP address of the EC2 instance',
        });
        new cdk.CfnOutput(this, 'EC2InstanceConnectEndpointInstructions', { 
            value: `Use 'aws ec2-instance-connect send-ssh-public-key' and then 'ssh -i <key-file> ec2-user@<EICE-IP-Address>' to connect.` 
        });


        new cdk.CfnOutput(this, 'NetworkId', {
            description: 'Managed Blockchain network identifier',
            value: network.networkId,
        });

        new cdk.CfnOutput(this, 'MemberId', {
            description: 'Managed Blockchain member identifier',
            value: network.memberId,
        });

        new cdk.CfnOutput(this, 'VpcEndpointServiceName', {
            description: 'Managed Blockchain network VPC endpoint service name',
            value: network.vpcEndpointServiceName,
        });

        new cdk.CfnOutput(this, 'OrdererEndpoint', {
            description: 'Managed Blockchain network ordering service endpoint',
            value: network.ordererEndpoint,
        });

        new cdk.CfnOutput(this, 'CaEndpoint', {
            description: 'Managed Blockchain member CA endpoint',
            value: network.caEndpoint,
        });

        new cdk.CfnOutput(this, 'AdminPasswordArn', {
            description: 'Secret ARN for the Hyperledger Fabric admin password',
            value: network.adminPasswordSecret.secretFullArn ?? network.adminPasswordSecret.secretArn,
        });

        new cdk.CfnOutput(this, 'AdminPrivateKeyArn', {
            description: 'Secret ARN for Hyperledger Fabric admin private key',
            value: network.adminPrivateKeySecret.secretFullArn ?? network.adminPrivateKeySecret.secretArn,
        });

        new cdk.CfnOutput(this, 'AdminSignedCertArn', {
            description: 'Secret ARN for Hyperledger Fabric admin signed certificate',
            value: network.adminSignedCertSecret.secretFullArn ?? network.adminSignedCertSecret.secretArn,
        });

        new cdk.CfnOutput(this, 'NodeIds', {
            description: 'Comma-separated list of Managed Blockchain node identifiers',
            value: network.nodes.map(n => n.nodeId).join(','),
        });

        new cdk.CfnOutput(this, 'NodeEndpoints', {
            description: 'Comma-separated list of Managed Blockchain node endpoints',
            value: network.nodes.map(n => n.endpoint).join(','),
        });

        new cdk.CfnOutput(this, 'NodeEventEndpoints', {
            description: 'Comma-separated list of Managed Blockchain node event endpoints',
            value: network.nodes.map(n => n.eventEndpoint).join(','),
        });

        new cdk.CfnOutput(this, 'FabricClient', {
            description: 'The client network to interact with the Hyperledger Fabric network.',
            value: network.client.node.id,
        });

        new cdk.CfnOutput(this, 'FabricClientVPCEndpoint', {
            description: 'Managed Blockchain network VPC endpoint.',
            value: network.client.vpcEndpoint.vpcEndpointId,
        });
        

    }
}