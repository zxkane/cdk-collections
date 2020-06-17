import { CloudFormationCustomResourceHandler, CloudFormationCustomResourceUpdateEvent, CloudFormationCustomResourceDeleteEvent } from 'aws-lambda';
import ECS = require('aws-sdk/clients/ecs');
const cfnCR = require('cfn-custom-resource');
const { configure, sendResponse, LOG_VERBOSE, SUCCESS, FAILED } = cfnCR;
const equal = require('deep-equal');
import Mustache = require('mustache');

configure({ logLevel: LOG_VERBOSE });

function toTaskDefinition(template: string, variables: any): ECS.Types.RegisterTaskDefinitionRequest {
    const taskJson = Mustache.render(Buffer.from(template, 'base64').toString('ascii'), variables);
    console.debug(`Will regsiter task definition ${taskJson}.`);
    return JSON.parse(taskJson);
}

export const taskDefinition: CloudFormationCustomResourceHandler = async (event, _context) => {
    console.info(`Receiving the event of task definition of ECS ${JSON.stringify(event, null, 2)}`);
    const ecs = new ECS();
    var responseData: any;
    var result = SUCCESS;  
    var reason: any = '';
    var resourceId: string | undefined = undefined;
    try {
        switch (event.RequestType) {
            case 'Create':
                const registerResp = await ecs.registerTaskDefinition(
                    toTaskDefinition(event.ResourceProperties.Template, event.ResourceProperties)).promise();
                    
                console.info(`Register task definition ${JSON.stringify(registerResp.$response.data, null, 2)}.`);
                responseData = registerResp.taskDefinition;
                resourceId = `ecs-task-definition-${registerResp.taskDefinition!.family}`;
                break;
            case 'Update':
                const updateEvent = event as CloudFormationCustomResourceUpdateEvent;
                resourceId = updateEvent.PhysicalResourceId;

                const newVersionRegisterResp = await ecs.registerTaskDefinition(
                    toTaskDefinition(event.ResourceProperties.Template, event.ResourceProperties)).promise();
                    
                console.info(`Register new task definition ${JSON.stringify(newVersionRegisterResp.$response.data, null, 2)}.`);
                responseData = newVersionRegisterResp.taskDefinition;
                if (updateEvent.OldResourceProperties.Family != updateEvent.ResourceProperties.Family) {
                    resourceId = `ecs-task-definition-${newVersionRegisterResp.taskDefinition!.family}`;
                }
                
                break;
            case 'Delete':
                const deleteEvent = event as CloudFormationCustomResourceDeleteEvent;
                resourceId = deleteEvent.PhysicalResourceId;

                console.info(`Ignore deregistering task definition with resource id '${resourceId}'.`);

                break;
        }
    } catch (err) {
        console.error(`Failed to process event of task definition of ECS due to ${err}.`);
        responseData = err.message;
        result = FAILED;
        reason = err.message;
    }
    return await sendResponse({ Status: result, Reason: reason, PhysicalResourceId: (resourceId ? resourceId : _context.logStreamName), Data: responseData }, event);
}
