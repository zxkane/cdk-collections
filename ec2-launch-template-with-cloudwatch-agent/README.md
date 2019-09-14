# Create a EC2 launch template to launch instances with Cloudwatch Agent installed and collect the memory and disk usage percentages

- Create a string parameter of SSM to store the configuration of Cloudwatch Agent
- Create an instance role of pushing Cloudwatch metrics and fetch configuration from SSM
- Create the EC2 launch template to install Cloudwatch Agent and fetch configuration from SSM via user data