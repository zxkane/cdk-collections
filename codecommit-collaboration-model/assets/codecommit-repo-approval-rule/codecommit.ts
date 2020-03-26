import { CloudFormationCustomResourceHandler, CloudFormationCustomResourceUpdateEvent, CloudFormationCustomResourceDeleteEvent } from 'aws-lambda';
import CodeCommit = require('aws-sdk/clients/codecommit');
const cfnCR = require('cfn-custom-resource');
const { configure, sendResponse, LOG_VERBOSE, SUCCESS, FAILED } = cfnCR;

configure({ logLevel: LOG_VERBOSE });

export const approvalRuleRepoAssociation: CloudFormationCustomResourceHandler = async (event, _context) => {
    console.info(`Receiving ApprovalRuleAssociationEvent of CodeCommit ${JSON.stringify(event, null, 2)}`);
    const codecommit = new CodeCommit();
    var responseData: any;
    var result = SUCCESS;  
    var reason: any = '';
    var resourceId: string | undefined = undefined;
    try {
        switch (event.RequestType) {
            case 'Create':
                const assoRsp = await codecommit.batchAssociateApprovalRuleTemplateWithRepositories({
                    approvalRuleTemplateName: event.ResourceProperties.ApprovalRuleTemplateName,
                    repositoryNames: event.ResourceProperties.RepositoryNames
                }).promise();
                console.info(`Associated ${assoRsp.associatedRepositoryNames} with ${event.ResourceProperties.ApprovalRuleTemplateName}.`);
                resourceId = `${event.ResourceProperties.ApprovalRuleTemplateName}-repos`;
                responseData = {
                    AssociatedRepoNames: assoRsp.associatedRepositoryNames,
                };
                break;
            case 'Update':
                const updateEvent = event as CloudFormationCustomResourceUpdateEvent;
                resourceId = `${updateEvent.ResourceProperties.ApprovalRuleTemplateName}-repos`;
                const added = updateEvent.ResourceProperties.ApprovalRuleTemplateName == 
                    updateEvent.OldResourceProperties.ApprovalRuleTemplateName ? 
                    (updateEvent.ResourceProperties.RepositoryNames as Array<string>).filter((element, index, array) => {
                        return !(updateEvent.OldResourceProperties.RepositoryNames as Array<string>).includes(element);
                    }) : updateEvent.ResourceProperties.RepositoryNames as Array<string>;
                const deleted = updateEvent.ResourceProperties.ApprovalRuleTemplateName == 
                    updateEvent.OldResourceProperties.ApprovalRuleTemplateName ? 
                    (updateEvent.OldResourceProperties.RepositoryNames as Array<string>).filter((element, index, array) => {
                        return !(updateEvent.ResourceProperties.RepositoryNames as Array<string>).includes(element);
                    }) : updateEvent.OldResourceProperties.RepositoryNames as Array<string>;
                const changes = [];
                if (added.length > 0) {
                    const assoRsp = await codecommit.batchAssociateApprovalRuleTemplateWithRepositories({
                        approvalRuleTemplateName: updateEvent.ResourceProperties.ApprovalRuleTemplateName,
                        repositoryNames: added
                    }).promise();
                    console.info(`Associated ${assoRsp.associatedRepositoryNames} with ${updateEvent.ResourceProperties.ApprovalRuleTemplateName}.`); 
                    responseData = {
                        AssociatedRepoNames: assoRsp.associatedRepositoryNames,
                    };
                }
                if (deleted.length > 0) {
                    const disassoRsp = codecommit.batchDisassociateApprovalRuleTemplateFromRepositories({
                        approvalRuleTemplateName: updateEvent.OldResourceProperties.ApprovalRuleTemplateName,
                        repositoryNames: deleted,
                    }).promise();
                    console.info(`DisAssociated ${(await disassoRsp).disassociatedRepositoryNames} with ${updateEvent.OldResourceProperties.ApprovalRuleTemplateName}.`); 
                    responseData = Object.assign(responseData ? responseData : {}, {
                        DisAssociatedRepoNames: (await disassoRsp).disassociatedRepositoryNames,
                    });
                }
                break;
            case 'Delete':
                const deleteEvent = event as CloudFormationCustomResourceDeleteEvent;
                resourceId = deleteEvent.PhysicalResourceId;
                const disassociateRsp = await codecommit.batchDisassociateApprovalRuleTemplateFromRepositories({
                    approvalRuleTemplateName: deleteEvent.ResourceProperties.ApprovalRuleTemplateName,
                    repositoryNames: deleteEvent.ResourceProperties.RepositoryNames
                }).promise();
                console.info(`Disassociated ${disassociateRsp.disassociatedRepositoryNames} with ${deleteEvent.ResourceProperties.ApprovalRuleTemplateName}.`);
                responseData = {
                    DisAssociatedRepoNames: disassociateRsp.disassociatedRepositoryNames,
                };
                break;
        }
    } catch (err) {
        console.error(`Failed to associate/disassociate approval rule template with repos due to ${err}.`);
        responseData = err.message;
        result = FAILED;
        reason = err.message;
    }
    return await sendResponse({ Status: result, Reason: reason, PhysicalResourceId: (resourceId ? resourceId : _context.logStreamName), Data: responseData }, event);
}
