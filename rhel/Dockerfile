# Use Rocky Linux 9 as base image (closest to RHEL 9.4)
FROM rockylinux:9

# Install nano, SELinux tools, systemd and other useful packages
RUN dnf update -y && \
    dnf install -y nano policycoreutils selinux-policy selinux-policy-targeted systemd libcap && \
    dnf clean all

# Enable SELinux in enforcing mode to simulate RHEL production environment
RUN echo "SELINUX=enforcing" > /etc/selinux/config && \
    echo "SELINUXTYPE=targeted" >> /etc/selinux/config && \
    touch /.autorelabel

# Create non-root user to simulate service user (like setup script creates)
RUN groupadd --system dicomweb && \
    useradd --system --gid dicomweb --shell /bin/false \
           --home-dir /opt/dicomweb-proxy --no-create-home \
           --comment "DICOM Web Proxy Service" dicomweb

# Enable systemd
RUN systemctl set-default multi-user.target

# Copy local build directory to container
COPY ./build/rhel /opt/rhel

# Expose the ports that were specified in the docker run command
EXPOSE 3006 443 11113 8888

# Use /sbin/init as the entry point to enable systemd
CMD ["/sbin/init"]