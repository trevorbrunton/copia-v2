#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MayflyStack } from "../lib/mayfly-stack";

const app = new cdk.App();
const env = app.node.tryGetContext("env") || "dev";

new MayflyStack(app, `Mayfly-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2",
  },
  stageName: env,
});
