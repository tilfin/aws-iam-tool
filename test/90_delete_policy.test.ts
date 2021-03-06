const glob = require('glob')
import util from 'util'
import path from 'path'
import { assert } from 'chai'
import { writeArray } from '@tilfin/stream-utils'
import { iam } from '../src/aws/iam'
import { main } from '../src/delete_policy'

describe('delete_policy on terminate stage', () => {
  before(async () => {
    const roleDir = path.resolve(__dirname, './fixtures/terminate/roles')
    const globPromise = util.promisify(glob)
    const files = await globPromise(`${roleDir}/*.json`)
    const roleNames = files.map(file => {
      return file.split('/').pop().replace(/\.json$/, '').replace(/\-ENV/, '-test')
    })

    for (let roleName of roleNames) {
      if (roleName.match(/\-ec2\-/)) {
        await iam.removeRoleFromInstanceProfile({
          InstanceProfileName: roleName, RoleName: roleName
        }).promise()
        .catch(err => console.error(err.message))

        await iam.deleteRole({ RoleName: roleName }).promise()
        .catch(err => console.error(err.message))

        await iam.deleteInstanceProfile({ InstanceProfileName: roleName }).promise()
        .catch(err => console.error(err.message))
      } else {
        await iam.deleteRole({ RoleName: roleName }).promise()
        .catch(err => console.error(err.message))
      }
    }
  })

  it('succeeds with valid results', async () => {
    let values: any[]
    const writer = writeArray((_, vals) => {
      values = vals
    })

    await main("^AWSLambdaBasicExecutionRole\-b3c4ecbd\-319d\-475f$", { noconfirm: true, writer })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'AWSLambdaBasicExecutionRole-b3c4ecbd-319d-475f',
      diff: undefined
    })
  })

  it('succeeds with valid results', async () => {
    let values: any[]
    const writer = writeArray((_, vals) => {
      values = vals.sort((a, b) => [].concat(a.target)[0].localeCompare([].concat(b.target)[0]))
    })

    await main("\-test$", { noconfirm: true, writer })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'bar-logs-lambda-test',
      diff: undefined
    })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1 %2',
      target: ['baz-dynamodb-items-test', 'v1'],
      diff: undefined
    })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'baz-dynamodb-items-test',
      diff: undefined
    })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'baz-dynamodb-users-test',
      diff: undefined
    })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'foo-s3-logs-test',
      diff: undefined
    })

    assert.deepEqual(values.shift(), {
      status: 'OK',
      message: 'Deleted %1',
      target: 'foo-s3-storage-test',
      diff: undefined
    })
  })
})
