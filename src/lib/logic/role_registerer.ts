'use strict'

import { MyRoleDoc, MyRoleDocument, MyRole } from "../aws/role";
import { iam } from '../aws/iam'
const iamRole = require('../aws/role')
const attach = require('../aws/attach')
import { Result, OK, NG, Skip } from '../utils/result'
import { IAM } from "aws-sdk";
import { RolePolicyPair, diffAttachedPolicies } from "../aws/attach";


export class RoleRegisterer {
	private _overwrite: boolean;

  constructor(opts: any = {}) {
    this._overwrite = opts['overwrite'] || false
  }

  async register({ name, document }: MyRoleDoc) {
    try {
      const results: Result[] = []
      await this._createRoleOrWithInstanceProfile(document, results)
      const rolePolicies = await this._getRolePolicies(document)

      const attachPromises: Promise<Result>[] = []
      const attachResults: Result[] = await Promise.all(attachPromises.concat(
        rolePolicies.attaching.map((entry: RolePolicyPair) => this._attachRolePolicy(entry)),
        rolePolicies.detaching.map((entry: RolePolicyPair) => this._detachRolePolicy(entry)),
        rolePolicies.unchanged.map((entry: RolePolicyPair) => {
          const policyName = onlyPolicyName(entry.PolicyArn)
          return Promise.resolve(Skip('Policy: %1 is already attached on Role: %2', [policyName, entry.RoleName]))
        })
      ))

      return results.concat(attachResults)
    } catch(err) {
      return NG('Failed to create Role: %1 invalid JSON format', name)
    }
  }

  async _createRoleOrWithInstanceProfile(document: MyRoleDocument, results: Result[]) {
    const roleName = document.Role.RoleName
    const createdRole = await this._createRole(document, results)
    if (createdRole && iamRole.isEc2Role(document.Role)) {
      const result = await this._createInstanceProfile(roleName, results)
      if (result !== null) {
        await this._addRoleToInstanceProfile(roleName, roleName, results)
      }
    }
    return createdRole
  }

  async _createRole(doc: MyRoleDocument, results: Result[]): Promise<MyRole | Result | null> {
    const roleName = doc.Role.RoleName

    if (doc.Role.Path.startsWith('/aws-service-role/')) {
      results.push(Skip('Role: %1 is AWS Service linked.', roleName))
      return null
    }

    try {
      const role = await iamRole.createRole(doc.Role)
      results.push(OK('Created Role: %1', roleName))
      return doc.Role
    } catch(err) {
      if (err.code === 'EntityAlreadyExists') {
        results.push(Skip('Role: %1 already exists.', roleName))
        return null
      } else if (err.code === 'MalformedPolicyDocument') {
        return NG('Failed to create Role: %1 invalid JSON format', roleName)
      }
      results.push(NG('Failed to create Role: %1', roleName))
      throw err
    }
  }

  async _createInstanceProfile(roleName: string, results: Result[]) {
    const params = {
      InstanceProfileName: roleName
    }

    try {
      const data = await iam.createInstanceProfile(params).promise()
      results.push(OK('Created InstanceProfile: %1', roleName))
      return data.InstanceProfile
    } catch(err) {
      if (err.code === 'EntityAlreadyExists') {
        results.push(Skip('InstanceProfile: %1 already exists.', roleName))
        return null
      }
      results.push(NG('Failed to create InstanceProfile: %1', roleName))
      throw err
    }
  }

  async _addRoleToInstanceProfile(profileName: string, roleName: string, results: Result[]) {
    const params = {
      InstanceProfileName: profileName,
      RoleName: roleName
    }

    try {
      iam.addRoleToInstanceProfile(params).promise()
      results.push(OK('Added InstanceProfile: %1 to Role: %2', [profileName, roleName]))
    } catch(err) {
      /*if (err.code === 'LimitExceeded') {
        console.log(Status.Skip, err.message)
        return
      }*/
      throw err
    }
  }

  async _getRolePolicies(role: MyRoleDocument) {
    const roleName = role.Role.RoleName
    const policyList = role.AttachedPolicies.map((item: IAM.AttachedPolicy) => {
      return {
        RoleName: roleName,
        PolicyArn: item.PolicyArn!,
      }
    })

    return diffAttachedPolicies(roleName, policyList)
  }

  async _attachRolePolicy(params: RolePolicyPair): Promise<Result> {
    const policyName = onlyPolicyName(params.PolicyArn)

    try {
      await iam.attachRolePolicy(params).promise()
      return OK('Attached %1 on %2', [policyName, params.RoleName])
    } catch(err) {
      if (err.code === 'NoSuchEntity') {
        return NG('Could not attach Policy: %1 that does not exist on %2.', [policyName, params.RoleName])
      }
      throw err
    }
  }

  async _detachRolePolicy(params: RolePolicyPair) {
    const policyName = onlyPolicyName(params.PolicyArn)

    await iam.detachRolePolicy(params).promise()
    return OK('Detached %1 on %2', [policyName, params.RoleName])
  }
}

function onlyPolicyName(policyArn: string) {
  return policyArn.substr(policyArn.indexOf('/') + 1)
}