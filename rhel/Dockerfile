# Use Rocky Linux 8 as base image
FROM rockylinux:8

# Install nano and other useful packages
RUN dnf update -y && \
    dnf install -y nano && \
    dnf clean all

# Copy local build directory to container
COPY ./build/rhel /opt/rhel

# Expose the ports that were specified in the docker run command
EXPOSE 3006 443 11113 8888

# Use /sbin/init as the entry point to enable systemd
CMD ["/sbin/init"]