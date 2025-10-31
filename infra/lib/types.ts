export type CDKContext = {
    appName: string
    stage: string
    branch: string
    ec2KeyPairName?: string
    env: {
        account: string
        region: string
    }
    hosting: {
        domainName: string
        certificateArn: string
        sourceCode: string
        sourceRepo: string
        ecrName: string
        dbHost: string
        dbUser: string
        dbPass: string
        dbName: string
    }
}