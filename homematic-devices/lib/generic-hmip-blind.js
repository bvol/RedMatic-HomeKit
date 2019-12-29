/* eslint-disable no-new */

const Accessory = require('./accessory');

function createService(channel) {
    console.log('generic-hmip-blind createService', channel);

    let intermediatePosition; // 0-100
    let LEVEL; // 0.0-1.0
    let LEVEL_2; // 0.0-1.0

    const channelIndex = channel.channel.split(':')[1];

    this.ccu.subscribe({
        datapointName: this.config.deviceAddress + ':' + channelIndex + '.LEVEL',
        cache: true,
        stable: false
    }, msg => {
        intermediatePosition = msg.value * 100;
    });

    const service = this.addService('WindowCovering', channel.name, channelIndex);

    service
        .get('CurrentPosition', this.config.deviceAddress + ':' + channelIndex + '.LEVEL', value => {
            LEVEL = value;
            intermediatePosition = value * 100;
            return LEVEL * 100;
        })

        .get('TargetPosition', this.config.deviceAddress + ':' + channelIndex + '.LEVEL', value => {
            if (typeof LEVEL === 'undefined') {
                LEVEL = value;
            }

            return LEVEL * 100;
        })

        .set('TargetPosition', (value, callback) => {
            LEVEL = value / 100;
            if (value === 0 && intermediatePosition === 0) {
                intermediatePosition = 1;
            } else if (value === 100 && intermediatePosition === 100) {
                intermediatePosition = 99;
            }

            this.node.debug(channel.name + ' intermediatePosition ' + intermediatePosition);
            service.update('CurrentPosition', intermediatePosition);

            const params = {
                LEVEL
            };
            if (channel.tilt) {
                params.LEVEL_2 = LEVEL_2;
            }

            this.node.debug('set ' + this.config.name + ' (WindowCovering) TargetPosition ' + value + ' -> ' + this.config.description.ADDRESS + ':' + channelIndex + ' ' + JSON.stringify(params));
            this.ccu.methodCall(this.config.iface, 'putParamset', [this.config.description.ADDRESS + ':' + channelIndex, 'VALUES', params])
                .then(() => {
                    callback();
                })
                .catch(() => {
                    callback(new Error(this.hap.HAPServer.Status.SERVICE_COMMUNICATION_FAILURE));
                });
        })

        .get('PositionState', this.config.deviceAddress + ':' + channelIndex + '.ACTIVITY_STATE', (value, c) => {
            switch (value) {
                case 1:
                    return c.INCREASING;
                case 2:
                    return c.DECREASING;
                default:
                    return c.STOPPED;
            }
        });

    if (channel.tilt) {
        service
            .get('CurrentVerticalTiltAngle', this.config.deviceAddress + ':' + channelIndex + '.LEVEL_2', value => {
                LEVEL_2 = (value * 180) - 90;
                return LEVEL_2;
            })

            .get('TargetVerticalTiltAngle', this.config.deviceAddress + ':' + channelIndex + '.LEVEL_2', value => {
                LEVEL_2 = (value * 180) - 90;
                return LEVEL_2;
            })

            .set('TargetVerticalTiltAngle', (value, callback) => {
                LEVEL_2 = (value + 90) / 180;
                const params = {
                    LEVEL,
                    LEVEL_2
                };
                this.node.debug('set ' + channel.name + ' (WindowCovering) TargetVerticalTiltAngle ' + value + ' -> ' + this.config.description.ADDRESS + ':' + channelIndex + ' ' + JSON.stringify(params));
                this.ccu.methodCall(this.config.iface, 'putParamset', [this.config.description.ADDRESS + ':' + channelIndex, 'VALUES', params])
                    .then(() => {
                        callback();
                    })
                    .catch(() => {
                        callback(new Error(this.hap.HAPServer.Status.SERVICE_COMMUNICATION_FAILURE));
                    });
            });
    }
}

class GenericHmipBlindAcc extends Accessory {
    constructor(config, node, channels) {
        super(config, node);
        this.channels = channels;
    }

    init() {
        console.log('GenericHmipBlind', this.channels);
        this.channels.forEach(channel => {
            createService.call(this, channel);
        });
    }
}

class GenericHmipBlind {
    constructor(config, node) {
        const {ccu} = node;
        this.ccu = ccu;

        this.config = config;
        console.log('GenericHmipBlind', config);

        let pos = 0;
        let channels = [];
        this.config.description.CHILDREN.forEach(channel => {
            const desc = this.ccu.metadata.devices['HmIP-RF'][channel];
            if (desc.TYPE === 'BLIND_VIRTUAL_RECEIVER' || desc.TYPE === 'SHUTTER_VIRTUAL_RECEIVER') {
                const name = this.ccu.channelNames[channel];
                const tilt = desc.TYPE === 'BLIND_VIRTUAL_RECEIVER' &&
                    (!this.config.options[channel] || this.config.options[channel].type !== 'VerticalTilt Disabled');
                if (pos === 0) {
                    if (!this.config.options[channel] || !this.config.options[channel].disabled) {
                        channels.push({channel, name, tilt});
                    }
                } else if (this.config.options[channel] && this.config.options[channel].enabled) {
                    channels.push({channel, name, tilt});
                }

                if (++pos === 3) {
                    if (channels.length > 0) {
                        new GenericHmipBlindAcc(Object.assign({}, config, {name}), node, channels);
                    }

                    channels = [];
                    pos = 0;
                }
            }
        });
    }
}

module.exports = GenericHmipBlind;
