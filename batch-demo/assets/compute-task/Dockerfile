FROM python:3.7-alpine

ENV TABLE_NAME 'BatchJobs'

RUN pip install boto3==1.10.* 

ADD compute.py /app/compute.py