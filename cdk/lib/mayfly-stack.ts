import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

interface MayflyStackProps extends cdk.StackProps {
  stageName: string;
}

export class MayflyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MayflyStackProps) {
    super(scope, id, props);

    // Cognito User Pool removed — auth migrated to Supabase Auth.
    // This stack is retained for future AWS infrastructure (e.g., Bedrock IAM roles).
  }
}
