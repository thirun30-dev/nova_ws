"""Random mission generator for throughput / scheduling experiments.

Submits pickup->dropoff missions with Poisson arrivals to /mission_manager/submit.
Run the same seed under different `policy` values to compare scheduling strategies.
"""
import random

import rclpy
from rclpy.node import Node

from nova_interfaces.srv import SubmitMission


class MissionGenerator(Node):

    def __init__(self):
        super().__init__('mission_generator')
        p = self.declare_parameter
        self.rate = float(p('rate_per_min', 2.0).value)
        self.max_missions = int(p('max_missions', 20).value)
        self.hp_prob = float(p('high_priority_prob', 0.2).value)
        self.pickups = list(p('pickups', ['pick_a', 'pick_b', 'pick_c', 'pick_d']).value)
        self.dropoffs = list(p('dropoffs', ['drop_1', 'drop_2']).value)
        self.rng = random.Random(int(p('seed', 42).value))

        self.client = self.create_client(SubmitMission, '/mission_manager/submit')
        self.sent = 0
        self.next_at = None
        self.create_timer(0.1, self.tick)
        self.get_logger().info(f'generating {self.rate}/min, max {self.max_missions or "inf"}')

    def now(self):
        return self.get_clock().now().nanoseconds * 1e-9

    def tick(self):
        if self.max_missions and self.sent >= self.max_missions:
            return
        if not self.client.service_is_ready():
            return
        now = self.now()
        if self.next_at is None:
            self.next_at = now
        if now < self.next_at:
            return
        req = SubmitMission.Request()
        req.pickup = self.rng.choice(self.pickups)
        req.dropoff = self.rng.choice(self.dropoffs)
        req.priority = 2 if self.rng.random() < self.hp_prob else 0
        self.client.call_async(req).add_done_callback(self.on_response)
        self.sent += 1
        self.next_at = now + self.rng.expovariate(self.rate / 60.0)

    def on_response(self, fut):
        res = fut.result()
        if res.accepted:
            self.get_logger().info(f'submitted {res.mission_id}: {res.message}')
        else:
            self.get_logger().warn(f'rejected: {res.message}')


def main(args=None):
    rclpy.init(args=args)
    node = MissionGenerator()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
