Template.updateSettingsForm.helpers({
  userName: function () {
    return Meteor.user().username
  },
  userEmail: function () {
    return Meteor.user().emails[0].address
  }
})
