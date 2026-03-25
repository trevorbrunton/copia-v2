#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CopiaMediaStack } from "../lib/media-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2",
};

const environment = app.node.tryGetContext("environment") || "dev";

new CopiaMediaStack(app, `CopiaMedia-${environment}`, {
  env,
  environment,
});
