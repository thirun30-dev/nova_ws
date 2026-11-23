import os
from glob import glob

from setuptools import setup

package_name = 'nova_web_bridge'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
        (os.path.join('share', package_name, 'config'), glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Thirunavukkarasu',
    maintainer_email='todo@todo.com',
    description='Robot-side backend for the NOVA web dashboard.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'web_bridge = nova_web_bridge.web_bridge:main',
        ],
    },
)
